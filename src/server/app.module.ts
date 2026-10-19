import { Module } from "@nestjs/common";
import { GraphQLModule } from "@nestjs/graphql";
import { MercuriusDriver, MercuriusDriverConfig } from "@nestjs/mercurius";
import { ApiKeyModule } from "../modules/api-key/api-key.module";
import { DatabaseModule } from "../modules/database/database.module";
import { ProxyModule } from "../modules/proxy-gateway/server/proxy.module";
import { RoutingModule } from "../modules/proxy-gateway/routing/routing.module";
import { RoutingController } from "../modules/proxy-gateway/routing/routing.controller";
import { AccountManagementController } from "../modules/cloud-account/controllers/account-management.controller";
import { SystemStatusController } from "../modules/cloud-account/controllers/system-status.controller";
import { WebUiController } from "../modules/cloud-account/controllers/web-ui.controller";
import { OAuthCallbackServer } from "../modules/cloud-account/services/OAuthCallbackServer";
import { OpenAIOAuthCallbackServer } from "../modules/cloud-account/services/OpenAIOAuthCallbackServer";
import { OAuthProviderLoginService } from "../modules/cloud-account/services/OAuthProviderLoginService";

@Module({
  imports: [
    DatabaseModule,
    ApiKeyModule,
    ProxyModule,
    RoutingModule,
    GraphQLModule.forRoot<MercuriusDriverConfig>({
      driver: MercuriusDriver,
      autoSchemaFile: true,
      graphiql: false,
      path: "/graphql",
      context: (req, reply) => ({ req, reply }),
    }),
  ],
  controllers: [
    AccountManagementController,
    RoutingController,
    SystemStatusController,
    WebUiController,
  ],
  providers: [OAuthCallbackServer, OpenAIOAuthCallbackServer, OAuthProviderLoginService],
})
export class AppModule {}
