import { Module } from '@nestjs/common';

import { AdminGuard } from '../../guards/admin.guard';
import { AuditManagementController, ThoughtManagementController } from './observability.controller';
import { TokenAnalyticsResolver } from './token-analytics.resolver';

@Module({
  controllers: [AuditManagementController, ThoughtManagementController],
  providers: [AdminGuard, TokenAnalyticsResolver],
})
export class ObservabilityModule {}
