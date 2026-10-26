import { parseAccountUpdateInput } from '@/modules/cloud-account/account-update';
import { GoogleAPIService } from '@/modules/cloud-account/services/GoogleAPIService';
import { consumeGoogleOAuthState } from '@/modules/cloud-account/services/google-oauth-state';
import { OAuthCallbackServer } from '@/modules/cloud-account/services/OAuthCallbackServer';
import { OAuthProviderLoginService } from '@/modules/cloud-account/services/OAuthProviderLoginService';
import type { CloudAccount, CloudProvider } from '@/modules/cloud-account/types';
import { AdminGuard } from '@/modules/proxy-gateway/server/guards/admin.guard';
import { Public } from '@/modules/proxy-gateway/server/guards/public.decorator';
import { AccountLeaseService } from '@/modules/proxy-gateway/server/modules/account-lease/account-lease.service';
import { jsonAccountStoreInstance } from '@/modules/proxy-gateway/server/modules/account-lease/adapters/json-account.store';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

interface OAuthCallbackDto {
  code: string;
  redirect_uri?: string;
}

@Controller('internal/accounts')
@UseGuards(AdminGuard)
export class AccountManagementController {
  private readonly logger = new Logger(AccountManagementController.name);

  constructor(
    private readonly accountLeaseService: AccountLeaseService,
    private readonly oauthCallbackServer: OAuthCallbackServer,
    private readonly oauthProviderLoginService: OAuthProviderLoginService,
  ) {}

  @Get()
  async listAccounts() {
    try {
      const accounts = await this.accountLeaseService.getAccountsOverview();
      return {
        data: accounts,
        total: accounts.length,
      };
    } catch (error) {
      this.logger.error('Failed to list accounts', error);
      throw new HttpException(
        { message: 'Failed to retrieve accounts', error: String(error) },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post()
  async addAccount(@Body() body: any) {
    const rawOauth = body?.claudeAiOauth || body?.claude_oauth;
    const provider = body?.provider || (rawOauth ? 'anthropic' : undefined);

    if (!provider || typeof provider !== 'string') {
      throw new HttpException('Provider is required', HttpStatus.BAD_REQUEST);
    }
    const normalizedProvider = provider.toLowerCase() as CloudProvider;
    const allowedProviders = ['google', 'anthropic', 'openai', 'copilot'];
    if (!allowedProviders.includes(normalizedProvider)) {
      throw new HttpException(
        `Provider must be one of: ${allowedProviders.join(', ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const id =
      body.id || `acc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const email = body.email || `${provider}-${Date.now()}@antigravity.proxy`;

    const newAccount: CloudAccount = {
      id,
      provider: normalizedProvider,
      auth_type: body.auth_type,
      email,
      name: body.name || null,
      api_key: body.api_key || undefined,
      session_key: body.session_key || undefined,
      organization_id: body.organization_id || undefined,
      github_token: body.github_token || undefined,
      created_at: Date.now(),
      last_used: Date.now(),
      health: {},
    };

    if (rawOauth) {
      newAccount.provider = 'anthropic';
      newAccount.auth_type = 'cli_oauth';
      newAccount.claude_oauth = rawOauth;
      newAccount.claudeAiOauth = rawOauth;
      const expiresInSec =
        typeof rawOauth.expiresAt === 'number'
          ? Math.max(60, Math.floor((rawOauth.expiresAt - Date.now()) / 1000))
          : 86400;

      newAccount.token = {
        access_token: rawOauth.accessToken,
        refresh_token: rawOauth.refreshToken || '',
        expires_in: expiresInSec,
        expiry_timestamp: Math.floor(Date.now() / 1000) + expiresInSec,
        token_type: 'Bearer',
        email,
      };
    }

    const rawOpenAiOauth = body?.tokens || body?.openai_oauth;
    if (
      rawOpenAiOauth &&
      (normalizedProvider === 'openai' || body?.auth_mode === 'chatgpt')
    ) {
      const accessToken =
        rawOpenAiOauth.access_token || rawOpenAiOauth.accessToken;
      const refreshToken =
        rawOpenAiOauth.refresh_token || rawOpenAiOauth.refreshToken;
      const idToken = rawOpenAiOauth.id_token || rawOpenAiOauth.idToken;
      const accountId = rawOpenAiOauth.account_id || rawOpenAiOauth.accountId;

      newAccount.provider = 'openai';
      newAccount.auth_type = 'cli_oauth';
      newAccount.account_id = accountId;

      let extractedEmail = body.email;
      if (!extractedEmail && idToken) {
        try {
          const parts = idToken.split('.');
          if (parts.length === 3) {
            const payload = JSON.parse(
              Buffer.from(parts[1], 'base64url').toString('utf8'),
            );
            if (payload.email) extractedEmail = payload.email;
          }
        } catch {
          // ignore
        }
      }

      if (extractedEmail) {
        newAccount.email = extractedEmail;
      }

      const expiresInSec = 864_000;
      newAccount.token = {
        access_token: accessToken,
        refresh_token: refreshToken || '',
        expires_in: expiresInSec,
        expiry_timestamp: Math.floor(Date.now() / 1000) + expiresInSec,
        token_type: 'Bearer',
        email: newAccount.email,
      };

      (newAccount as any).tokens = {
        access_token: accessToken,
        refresh_token: refreshToken,
        id_token: idToken,
        account_id: accountId,
      };
      (newAccount as any).openai_oauth = {
        accessToken,
        refreshToken,
        idToken,
        accountId,
        expiresAt: Date.now() + expiresInSec * 1000,
      };
    }

    await jsonAccountStoreInstance.upsertAccount(newAccount);
    await this.accountLeaseService.loadAccounts();

    return {
      success: true,
      message: 'Account added successfully',
      data: newAccount,
    };
  }

  @Patch(':id')
  async updateAccount(@Param('id') accountId: string, @Body() body: unknown) {
    // Validate before touching storage so a bad request never writes partially.
    const parsed = parseAccountUpdateInput(body);

    const existing = await jsonAccountStoreInstance.getAccount(accountId);
    if (!existing) {
      throw new NotFoundException('Account not found');
    }

    await jsonAccountStoreInstance.upsertAccount({ ...existing, ...parsed });
    await this.accountLeaseService.loadAccounts();

    const overview = await this.accountLeaseService.getAccountsOverview();
    return {
      success: true,
      data: overview.find((account) => account.id === accountId),
    };
  }

  @Get('oauth/claude/init')
  initClaudeOAuth(@Query('redirect_uri') customRedirectUri?: string) {
    return this.oauthProviderLoginService.initClaudeOAuth(customRedirectUri);
  }

  @Post('oauth/claude/exchange')
  async exchangeClaudeOAuth(
    @Body()
    body: {
      code: string;
      codeVerifier: string;
      redirectUri: string;
      state?: string;
      email?: string;
    },
  ) {
    if (!body?.code || !body?.codeVerifier || !body?.redirectUri) {
      throw new HttpException(
        'code, codeVerifier, and redirectUri are required',
        HttpStatus.BAD_REQUEST,
      );
    }
    const account =
      await this.oauthProviderLoginService.exchangeClaudeCode(body);
    return { success: true, account };
  }

  @Get('oauth/openai/init')
  initOpenAIOAuth(@Query('redirect_uri') customRedirectUri?: string) {
    return this.oauthProviderLoginService.initOpenAIOAuth(customRedirectUri);
  }

  @Post('oauth/openai/exchange')
  async exchangeOpenAIOAuth(
    @Body()
    body: {
      code: string;
      codeVerifier: string;
      redirectUri: string;
      email?: string;
    },
  ) {
    if (!body?.code || !body?.codeVerifier || !body?.redirectUri) {
      throw new HttpException(
        'code, codeVerifier, and redirectUri are required',
        HttpStatus.BAD_REQUEST,
      );
    }
    const account =
      await this.oauthProviderLoginService.exchangeOpenAICode(body);
    return { success: true, account };
  }

  @Get('oauth/openai/callback')
  @Public()
  async openAIOAuthCallback(
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
    @Query('error_description') errorDescription?: string,
  ) {
    const html = (title: string, message: string, ok: boolean): string => {
      const color = ok ? '#10b981' : '#ef4444';
      return `<!DOCTYPE html>
<html lang="vi">
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #09090b; color: #e4e4e7; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: #18181b; border: 1px solid #27272a; border-radius: 16px; padding: 40px 48px; max-width: 460px; text-align: center; }
    h2 { margin-top: 0; color: ${color}; }
    p { color: #a1a1aa; line-height: 1.6; word-break: break-word; }
    code { background: #27272a; padding: 2px 6px; border-radius: 6px; font-size: 12px; color: #e4e4e7; user-select: all; }
    .btn { display: inline-block; margin-top: 12px; padding: 10px 20px; background: ${color}; color: #09090b; border-radius: 10px; text-decoration: none; font-weight: 600; }
  </style>
  </head>
  <body><div class="card"><h2>${title}</h2><p>${message}</p>
  <a class="btn" href="http://localhost:8045/accounts">Quay lại Dashboard</a></div></body>
</html>`;
    };

    if (error || !code || !state) {
      const errMsg = errorDescription || error || 'Thiếu mã code';
      return html(
        'Đăng nhập OpenAI thất bại',
        `Không nhận được mã xác thực: <code>${errMsg}</code>`,
        false,
      );
    }

    const pending = OAuthProviderLoginService.consumeOpenAiState(state);
    if (!pending) {
      return html(
        'Đăng nhập OpenAI thất bại',
        'Trạng thái OAuth không hợp lệ hoặc đã hết hạn. Vui lòng thử lại.',
        false,
      );
    }

    try {
      const account =
        await OAuthProviderLoginService.exchangeAndSaveOpenAiAccount({
          code,
          codeVerifier: pending.codeVerifier,
          redirectUri: pending.redirectUri,
        });
      await this.accountLeaseService.loadAccounts();
      this.logger.log(`OpenAI OAuth callback succeeded for ${account.email}`);
      return html(
        'Thành công!',
        `Tài khoản <strong>${account.email}</strong> đã được thêm thành công qua OpenAI OAuth. Bạn có thể đóng cửa sổ này.`,
        true,
      );
    } catch (err) {
      this.logger.error('OpenAI OAuth callback exchange failed', err);
      return html(
        'Xảy ra lỗi',
        err instanceof Error ? err.message : String(err),
        false,
      );
    }
  }

  @Post('copilot/device/code')
  async startCopilotDeviceFlow() {
    return await this.oauthProviderLoginService.startCopilotDeviceFlow();
  }

  @Post('copilot/device/poll')
  async pollCopilotDeviceCode(
    @Body() body: { device_code: string; email?: string },
  ) {
    if (!body?.device_code) {
      throw new HttpException(
        'device_code is required',
        HttpStatus.BAD_REQUEST,
      );
    }
    return await this.oauthProviderLoginService.pollCopilotDeviceCode(body);
  }

  @Post('sync')
  async syncAccounts(@Query('id') accountId?: string) {
    try {
      if (accountId) {
        const synced =
          await this.accountLeaseService.syncSingleAccount(accountId);
        if (!synced) {
          throw new HttpException(
            'Account not found or sync failed',
            HttpStatus.BAD_REQUEST,
          );
        }
        return {
          success: true,
          message: `Account ${accountId} synced successfully`,
        };
      }

      await this.accountLeaseService.syncAllAccountQuotas();
      return { success: true, message: 'All accounts synced successfully' };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('Sync failed', error);
      throw new HttpException(
        { message: 'Sync failed', error: String(error) },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete(':id')
  async deleteAccount(@Param('id') accountId: string) {
    try {
      const deleted =
        await this.accountLeaseService.deleteAccountById(accountId);
      if (!deleted) {
        throw new HttpException('Account not found', HttpStatus.NOT_FOUND);
      }
      return { success: true, message: `Account ${accountId} deleted` };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Failed to delete account ${accountId}`, error);
      throw new HttpException(
        { message: 'Failed to delete account', error: String(error) },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('oauth/url')
  getOAuthUrl(@Query('redirect_uri') customRedirectUri?: string) {
    try {
      const redirectUri =
        customRedirectUri ||
        process.env.GOOGLE_OAUTH_REDIRECT_URI ||
        this.oauthCallbackServer.getRedirectUri();
      const url = GoogleAPIService.getAuthUrl(undefined, redirectUri);
      return { url };
    } catch (error) {
      this.logger.error('Failed to generate OAuth URL', error);
      throw new HttpException(
        { message: 'Failed to generate OAuth URL', error: String(error) },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Public()
  @Get('oauth/callback')
  async oauthCallback(
    @Req() req: FastifyRequest,
    @Query('code') code?: string,
    @Query('error') error?: string,
    @Query('state') state?: string,
  ) {
    if (error || !code) {
      return this.oauthCallbackServer.renderError(error || 'Thiếu mã code');
    }

    if (!consumeGoogleOAuthState(state)) {
      return this.oauthCallbackServer.renderError(
        'Trạng thái OAuth không hợp lệ hoặc đã hết hạn. Vui lòng thử lại.',
      );
    }

    try {
      // Reconstruct the exact redirect_uri that generated this auth URL so the
      // token exchange matches what Google issued the code for.
      const protocol = req.protocol || 'http';
      const host = req.headers.host || req.hostname;
      const redirectUri = `${protocol}://${host}/internal/accounts/oauth/callback`;
      const account = await this.oauthCallbackServer.saveOAuthAccount(
        code,
        redirectUri,
      );
      return this.oauthCallbackServer.renderSuccess(account.email, account.id);
    } catch (error) {
      this.logger.error('OAuth callback failed', error);
      return this.oauthCallbackServer.renderError(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  @Public()
  @Post('oauth/callback')
  async handleOAuthCallback(@Body() body: OAuthCallbackDto) {
    if (!body?.code) {
      throw new HttpException(
        'Authorization code is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const redirectUri =
        body.redirect_uri ||
        process.env.GOOGLE_OAUTH_REDIRECT_URI ||
        this.oauthCallbackServer.getRedirectUri();
      const account = await this.oauthCallbackServer.saveOAuthAccount(
        body.code,
        redirectUri,
      );

      return {
        success: true,
        account: {
          id: account.id,
          email: account.email,
          project_id: account.token?.project_id || '',
        },
      };
    } catch (error) {
      this.logger.error('OAuth token exchange failed', error);
      throw new HttpException(
        {
          message: 'OAuth exchange failed',
          error: error instanceof Error ? error.message : String(error),
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
