import { UnauthorizedException } from '@nestjs/common';
import { AdminGuard } from './admin.guard';

function context(headers: Record<string, string>) {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => ({ headers, ip: '127.0.0.1' }) }),
  } as any;
}

describe('AdminGuard', () => {
  it('rejects a request with no token', async () => {
    const guard = new AdminGuard({ validateAdminKey: jest.fn() } as any);
    await expect(guard.canActivate(context({}))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a client-role or invalid token', async () => {
    const guard = new AdminGuard({ validateAdminKey: jest.fn().mockResolvedValue(false) } as any);
    await expect(
      guard.canActivate(context({ authorization: 'Bearer sk-ag-client' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('allows an admin token', async () => {
    const guard = new AdminGuard({ validateAdminKey: jest.fn().mockResolvedValue(true) } as any);
    await expect(
      guard.canActivate(context({ authorization: 'Bearer sk-ag-admin' })),
    ).resolves.toBe(true);
  });

  it('still allows @Public handlers', async () => {
    const guard = new AdminGuard({ validateAdminKey: jest.fn() } as any);
    const ctx = context({});
    (ctx.getHandler as any) = () => {
      const handler = () => {};
      Reflect.defineMetadata('isPublic', true, handler);
      return handler;
    };
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});
