/**
 * WebSocket Agent Communication Test
 * Tests real-time communication between agents via WebSocket server
 */

import {
  startServer,
  stopServer,
  generateAgentToken,
  isAgentConnected,
  sendTaskToAgent,
  onResult,
  onDisconnect,
  getConnectionStats
} from "../../src/ws-server.ts";

async function runTest() {
  console.log("=== WebSocket Agent Communication Test ===\n");

  // Start server on test port
  const TEST_PORT = 9099;
  startServer(TEST_PORT);

  // Track disconnects
  const disconnects: string[] = [];
  onDisconnect((agentId, reason) => {
    disconnects.push(`Agent ${agentId}: ${reason}`);
  });

  // Track results
  const results: any[] = [];
  onResult((agentId, result) => {
    results.push({ agentId, ...result });
  });

  // Wait for server to start
  await Bun.sleep(100);

  console.log("1. Generating tokens for test agents...");
  const token1 = generateAgentToken(101);
  const token2 = generateAgentToken(102);
  const token3 = generateAgentToken(103);
  console.log(`   Agent 101 token: ${token1.slice(0, 16)}...`);
  console.log(`   Agent 102 token: ${token2.slice(0, 16)}...`);
  console.log(`   Agent 103 token: ${token3.slice(0, 16)}...`);

  console.log("\n2. Connecting agents via WebSocket...");

  // Connect 3 agents
  const ws1 = new WebSocket(`ws://localhost:${TEST_PORT}?token=${token1}`);
  const ws2 = new WebSocket(`ws://localhost:${TEST_PORT}?token=${token2}`);
  const ws3 = new WebSocket(`ws://localhost:${TEST_PORT}?token=${token3}`);

  // Track received messages per agent
  const received: Record<number, any[]> = { 101: [], 102: [], 103: [] };

  ws1.onmessage = (e) => received[101].push(JSON.parse(String(e.data)));
  ws2.onmessage = (e) => received[102].push(JSON.parse(String(e.data)));
  ws3.onmessage = (e) => received[103].push(JSON.parse(String(e.data)));

  // Wait for connections
  await new Promise(resolve => {
    let connected = 0;
    const checkConnection = () => {
      if (ws1.readyState === 1) connected++;
      if (ws2.readyState === 1) connected++;
      if (ws3.readyState === 1) connected++;
      if (connected >= 3) resolve(true);
      else setTimeout(checkConnection, 50);
    };
    checkConnection();
  });

  console.log(`   Connected: ${isAgentConnected(101)}, ${isAgentConnected(102)}, ${isAgentConnected(103)}`);

  const stats = getConnectionStats();
  console.log(`   Total connected: ${stats.connectedCount}`);

  console.log("\n3. Server sends task to Agent 101...");
  const taskSent = sendTaskToAgent(101, {
    id: "task_ws_test_1",
    prompt: "Process this request",
    priority: "high",
    assigned_at: new Date().toISOString(),
  });
  console.log(`   Task sent: ${taskSent}`);

  await Bun.sleep(100);
  console.log(`   Agent 101 received: ${received[101].length} messages`);
  console.log(`   Message type: ${received[101][0]?.type}`);

  console.log("\n4. Agent 101 sends result back to server...");
  ws1.send(JSON.stringify({
    type: "result",
    taskId: "task_ws_test_1",
    status: "completed",
    output: "Request processed successfully",
    duration_ms: 1500,
  }));

  await Bun.sleep(100);
  console.log(`   Results received: ${results.length}`);
  console.log(`   Result: ${JSON.stringify(results[0])}`);

  console.log("\n5. Testing ping/pong keepalive...");
  // Send pong from agent
  ws2.send(JSON.stringify({ type: "pong", agentId: 102 }));
  await Bun.sleep(50);
  console.log(`   Pong sent from Agent 102`);

  console.log("\n6. Testing agent disconnection cleanup...");
  ws3.close(1000, "Test disconnect");
  await Bun.sleep(100);

  console.log(`   Disconnects tracked: ${disconnects.length}`);
  console.log(`   Disconnect reason: ${disconnects[0] || "none"}`);
  console.log(`   Agent 103 still connected: ${isAgentConnected(103)}`);

  console.log("\n7. Testing invalid token rejection...");
  const wsInvalid = new WebSocket(`ws://localhost:${TEST_PORT}?token=invalid_token`);
  await new Promise(resolve => {
    wsInvalid.onerror = () => resolve(true);
    wsInvalid.onclose = () => resolve(true);
    setTimeout(() => resolve(false), 500);
  });
  const invalidRejected = wsInvalid.readyState !== 1;
  console.log(`   Invalid token rejected: ${invalidRejected}`);

  // Clean up
  ws1.close();
  ws2.close();
  stopServer();

  const allPassed =
    taskSent &&
    received[101].length > 0 &&
    results.length > 0 &&
    !isAgentConnected(103) &&
    invalidRejected;

  console.log("\n" + "=".repeat(50));
  console.log(allPassed ? "✅ All WebSocket communication tests PASSED!" : "❌ Some tests FAILED");
  console.log("=".repeat(50));

  process.exit(allPassed ? 0 : 1);
}

runTest();
