export function buildLiveSnapshot(scene, overrides, singleCharacter) {
  const snapshot = structuredClone(scene);
  if (!snapshot.characters.some((item) => item.enabled) && singleCharacter) {
    snapshot.singleCharacter = { ...singleCharacter };
  }
  for (const instance of snapshot.characters) {
    instance.currentState = overrides.get(instance.instanceId)?.stateId || instance.currentState || instance.initialState;
  }
  return snapshot;
}

export function mergeChatBroadcast(scene, updates) {
  scene.broadcast = { ...scene.broadcast, ...updates };
  return scene;
}
