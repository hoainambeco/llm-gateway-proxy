import { ModelRoutingService } from './model-routing.service';

describe('ModelRoutingService', () => {
  let service: ModelRoutingService;

  beforeEach(() => {
    service = new ModelRoutingService();
  });

  it('resolves the built-in Claude 3.5 Sonnet mapping', () => {
    expect(service.resolveModelRoute('claude-3-5-sonnet-20241022')).toEqual({
      requestedModel: 'claude-3-5-sonnet-20241022',
      normalizedModel: 'claude-3-5-sonnet-20241022',
      resolvedModel: 'claude-sonnet-4-6-thinking',
      source: 'built-in',
    });
  });

  it('resolves the built-in Gemini 3.1 Pro preview mapping', () => {
    expect(service.resolveModelRoute('gemini-3.1-pro-preview')).toEqual({
      requestedModel: 'gemini-3.1-pro-preview',
      normalizedModel: 'gemini-3.1-pro-preview',
      resolvedModel: 'gemini-3.1-pro-high',
      source: 'built-in',
    });
  });

  it('strips a leading models/ prefix before resolving', () => {
    const requestedModel = 'models/claude-3-5-sonnet-20241022';

    expect(service.resolveModelRoute(requestedModel)).toEqual({
      requestedModel,
      normalizedModel: 'claude-3-5-sonnet-20241022',
      resolvedModel: 'claude-sonnet-4-6-thinking',
      source: 'built-in',
    });
  });

  it('trims surrounding whitespace before resolving', () => {
    const requestedModel = '  claude-3-5-sonnet-20241022  ';

    expect(service.resolveModelRoute(requestedModel)).toEqual({
      requestedModel,
      normalizedModel: 'claude-3-5-sonnet-20241022',
      resolvedModel: 'claude-sonnet-4-6-thinking',
      source: 'built-in',
    });
  });

  it('reports a supported model that maps to itself as canonical', () => {
    expect(service.resolveModelRoute('claude-sonnet-4-6-thinking')).toEqual({
      requestedModel: 'claude-sonnet-4-6-thinking',
      normalizedModel: 'claude-sonnet-4-6-thinking',
      resolvedModel: 'claude-sonnet-4-6-thinking',
      source: 'canonical',
    });
  });

  it('returns a miss with the normalized id unchanged for an unknown model', () => {
    const requestedModel = 'not-a-real-model';

    expect(service.resolveModelRoute(requestedModel)).toEqual({
      requestedModel,
      normalizedModel: 'not-a-real-model',
      resolvedModel: 'not-a-real-model',
      source: 'miss',
    });
  });
});
