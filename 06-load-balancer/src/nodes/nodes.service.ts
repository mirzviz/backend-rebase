import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '../logging';
import { NodeRecord, NodeRegistry } from '../nodeRegistry';
import { isRegistrationOpen } from '../registrationWindow';
import { validateNodeRegistration } from '../validation';
import { Config } from '../config';
import { LB_CONFIG, REGISTRATION_STARTED_AT, LOGGER } from '../shared/shared.module';

export type RegisterNodeResult =
  | { kind: 'registered'; record: NodeRecord }
  | { kind: 'registration-closed' }
  | { kind: 'invalid'; error: string };

@Injectable()
export class NodesService {
  constructor(
    private readonly registry: NodeRegistry,
    @Inject(LB_CONFIG) private readonly config: Config,
    @Inject(REGISTRATION_STARTED_AT) private readonly startedAt: number,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  register(body: unknown): RegisterNodeResult {
    if (!isRegistrationOpen({ startedAt: this.startedAt, registrationDurationSeconds: this.config.registrationDurationSeconds })) {
      return { kind: 'registration-closed' };
    }

    const result = validateNodeRegistration(body);
    if (!result.ok) {
      return { kind: 'invalid', error: result.error };
    }

    const record = this.registry.upsert(result.value.destination, result.value.name);
    this.logger.log('info', 'node registered', {
      id: record.id,
      destination: record.destination,
      name: record.name,
    });
    return { kind: 'registered', record };
  }

  list(): NodeRecord[] {
    return this.registry.list();
  }
}
