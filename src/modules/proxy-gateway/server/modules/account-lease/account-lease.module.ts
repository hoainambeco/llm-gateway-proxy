import { Module } from '@nestjs/common';

import {
  ACCOUNT_LEASE_ACCOUNT_STORE,
  ACCOUNT_LEASE_UPSTREAM,
  cloudAccountStoreAdapter,
  googleAccountLeaseUpstreamAdapter,
} from './interfaces/account-lease-adapters';
import { RateLimitTrackerService } from '../../shared/services/rate-limit-tracker.service';
import {
  ModelAvailabilityService,
  proxyModelAvailabilityStore,
} from '../../shared/services/model-availability.service';
import { AccountLeaseService } from './account-lease.service';
import { ImageAccountSchedulerService } from './image-account-scheduler.service';
import { UpstreamsModule } from '@/modules/proxy-gateway/upstreams/upstreams.module';
import {
  COOLDOWN_BUS_TOKEN,
  NoopCooldownBus,
  RedisCooldownBus,
} from '../../shared/services/cooldown-bus';

@Module({
  imports: [UpstreamsModule],
  providers: [
    AccountLeaseService,
    ImageAccountSchedulerService,
    // Owns the lockout and failure-count maps. Lives here rather than in the shared module
    // because `AccountLeaseService` is its only writer, and putting it in `shared/` would
    // make `SharedServicesModule` and `AccountLeaseModule` import each other.
    RateLimitTrackerService,
    {
      provide: COOLDOWN_BUS_TOKEN,
      useFactory: () => {
        if (process.env.REDIS_URL) {
          const bus = new RedisCooldownBus();
          void bus.init();
          return bus;
        }
        return new NoopCooldownBus();
      },
    },
    {
      provide: ModelAvailabilityService,
      useValue: proxyModelAvailabilityStore,
    },
    {
      provide: ACCOUNT_LEASE_ACCOUNT_STORE,
      useValue: cloudAccountStoreAdapter,
    },
    {
      provide: ACCOUNT_LEASE_UPSTREAM,
      useValue: googleAccountLeaseUpstreamAdapter,
    },
  ],
  exports: [AccountLeaseService, RateLimitTrackerService],
})
export class AccountLeaseModule {}
