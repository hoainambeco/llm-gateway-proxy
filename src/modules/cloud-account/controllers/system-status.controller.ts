import { Controller, Get, UseGuards } from '@nestjs/common';
import { AccountLeaseService } from '@/modules/proxy-gateway/server/modules/account-lease/account-lease.service';
import { ApiKeyService } from '@/modules/api-key/api-key.service';
import { AdminGuard } from '@/modules/proxy-gateway/server/guards/admin.guard';
import { getServerConfig } from '@/server/server-config';
import { getOpenAICompatibleModels } from '@/modules/proxy-gateway/antigravity/ModelMapping';

@Controller('internal/system')
@UseGuards(AdminGuard)
export class SystemStatusController {
  constructor(
    private readonly accountLeaseService: AccountLeaseService,
    private readonly apiKeyService: ApiKeyService,
  ) {}

  @Get('status')
  async getStatus() {
    const config = getServerConfig();
    const accounts = await this.accountLeaseService.getAccountsOverview();
    const activeAccounts = accounts.filter(
      (a) => a.is_active !== false && a.is_healthy && !a.is_cooldown,
    );
    const apiKeys = await this.apiKeyService.listKeys();
    const activeKeys = apiKeys.filter((k) => k.isActive);
    const models = getOpenAICompatibleModels(
      {},
      this.accountLeaseService.getAllCollectedModels(),
    );

    return {
      version: '1.0.0',
      uptime_seconds: Math.floor(process.uptime()),
      port: config?.port ?? 8044,
      routing_strategy: process.env.ROUTING_STRATEGY || 'round-robin',
      accounts: {
        total: accounts.length,
        active: activeAccounts.length,
        in_cooldown: accounts.filter((a) => a.is_cooldown).length,
      },
      api_keys: {
        total: apiKeys.length,
        active: activeKeys.length,
      },
      models: {
        total: models.length,
      },
    };
  }
}
