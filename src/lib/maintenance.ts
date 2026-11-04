const state = globalThis as typeof globalThis & { aCenterMoving?: boolean; aCenterAIOperations?: number };
export function storageBusy() { return state.aCenterMoving === true; }
export function setStorageBusy(value: boolean) { state.aCenterMoving = value; }
export function beginAIOperation() { if(storageBusy())return false;state.aCenterAIOperations=(state.aCenterAIOperations||0)+1;return true; }
export function endAIOperation() { state.aCenterAIOperations=Math.max(0,(state.aCenterAIOperations||0)-1); }
export function aiOperationActive() { return (state.aCenterAIOperations||0)>0; }
