import type { AgentClaims } from '../shared/agent-auth';
import type { Session } from '../shared/contracts';
export type AppEnv = {
  Bindings: Env;
  Variables: { session: Session; agent?: AgentClaims };
};
