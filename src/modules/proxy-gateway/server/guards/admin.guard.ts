import { ApiKeyService } from "@/modules/api-key/api-key.service";
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
} from "@nestjs/common";
import { GqlExecutionContext } from "@nestjs/graphql";
import { getServerConfig } from "../../../../server/server-config";
import {
  extractApiKeyToken,
  hasConfiguredApiKey,
  type RequestHeaders,
} from "./api-key-auth.util";
import { IS_PUBLIC_KEY } from "./public.decorator";

@Injectable()
export class AdminGuard implements CanActivate {
  private readonly logger = new Logger(AdminGuard.name);

  constructor(
    @Optional()
    @Inject(ApiKeyService)
    private readonly apiKeyService?: ApiKeyService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handlerPublic = Reflect.getMetadata(
      IS_PUBLIC_KEY,
      context.getHandler(),
    );
    const classPublic = Reflect.getMetadata(
      IS_PUBLIC_KEY,
      context.getClass(),
    );
    if (handlerPublic || classPublic) {
      return true;
    }

    let request = context
      .switchToHttp()
      .getRequest<{ headers?: RequestHeaders; ip?: string; socket?: any; raw?: any }>();

    if (!request || !request.headers) {
      const gqlContext = GqlExecutionContext.create(context).getContext();
      request = gqlContext?.req || gqlContext?.request || gqlContext?.reply?.request;
    }

    const clientToken = extractApiKeyToken(request?.headers);

    const config = getServerConfig();
    const masterKey = (
      config?.api_key ||
      process.env.PROXY_API_KEY ||
      ""
    ).trim();

    // 1. If client provided a token, validate it
    if (clientToken) {
      if (this.apiKeyService) {
        const isAdmin = await this.apiKeyService.validateAdminKey(clientToken);
        if (isAdmin) {
          return true;
        }
      }
      if (hasConfiguredApiKey(masterKey) && clientToken === masterKey) {
        return true;
      }
      this.logger.warn(`Rejected unauthorized admin request with invalid token`);
      throw new UnauthorizedException("Admin API key validation failed");
    }

    // 2. Otherwise require an API key
    throw new UnauthorizedException("API key is required");
  }
}
