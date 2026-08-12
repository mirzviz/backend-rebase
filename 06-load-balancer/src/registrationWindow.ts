// Shared between the nodes and blobs services: registering a node and
// routing a blob request both gate on the same "are we still within the
// startup window" rule, so it lives in one place rather than two.
export interface RegistrationWindow {
  startedAt: number;
  registrationDurationSeconds: number;
}

export function isRegistrationOpen(window: RegistrationWindow): boolean {
  return Date.now() - window.startedAt < window.registrationDurationSeconds * 1000;
}
