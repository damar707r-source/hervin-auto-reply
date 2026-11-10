client.on("messageCreate", async message => {
  try {
    await games.handleGameMessage(message);
  } catch (error) {
    console.error("[HERVIN GAMES]", error);
  }
});
