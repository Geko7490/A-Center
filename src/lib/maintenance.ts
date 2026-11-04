const state = globalThis as typeof globalThis & { aCenterMoving?: boolean };
export function storageBusy() { return state.aCenterMoving === true; }
export function setStorageBusy(value: boolean) { state.aCenterMoving = value; }
