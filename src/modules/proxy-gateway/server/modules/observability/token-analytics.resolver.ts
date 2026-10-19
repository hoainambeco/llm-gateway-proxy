import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';
import { AdminGuard } from '../../guards/admin.guard';
import { trafficAuditService } from '@/modules/proxy-gateway/audit/traffic-audit.service';
import { TokenStatsFilterInput, TokenUsageStatsResponse } from './dto/token-analytics.dto';

@Resolver()
@UseGuards(AdminGuard)
export class TokenAnalyticsResolver {
  @Query(() => TokenUsageStatsResponse, {
    name: 'tokenUsageStats',
    description: 'Query token usage statistics aggregated across time, models, and API keys',
  })
  async tokenUsageStats(
    @Args('filter') filter: TokenStatsFilterInput,
  ): Promise<TokenUsageStatsResponse> {
    return trafficAuditService.getTokenUsageStats(filter);
  }
}
