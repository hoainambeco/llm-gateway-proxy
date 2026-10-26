import {
  extractGoogleErrorDetails,
  classifyForbiddenUpstreamError,
  isProjectLicenseErrorMessage,
} from './google-error-details';

describe('google-error-details', () => {
  describe('isProjectLicenseErrorMessage', () => {
    it('detects license error by error code #3501', () => {
      expect(isProjectLicenseErrorMessage('Request failed with error #3501')).toBe(true);
      expect(isProjectLicenseErrorMessage('Error code #3501: license issue')).toBe(true);
    });

    it('detects license error by phrase combination', () => {
      expect(
        isProjectLicenseErrorMessage(
          'Your Google Cloud Project requires a Code Assist License to proceed',
        ),
      ).toBe(true);
    });

    it('returns false for unrelated messages', () => {
      expect(isProjectLicenseErrorMessage('Resource exhausted: quota exceeded')).toBe(false);
      expect(isProjectLicenseErrorMessage('Permission denied')).toBe(false);
    });
  });

  describe('extractGoogleErrorDetails', () => {
    it('extracts structured details from an object payload', () => {
      const payload = {
        error: {
          code: 403,
          message: 'Permission denied',
          details: [
            {
              '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
              reason: 'VALIDATION_REQUIRED',
              domain: 'cloudcode-pa.googleapis.com',
              metadata: {
                validation_link: 'https://cloud.google.com/validate',
              },
            },
          ],
        },
      };

      const result = extractGoogleErrorDetails(payload);
      expect(result).toBeDefined();
      expect(result).toHaveLength(1);
      expect(result![0].reason).toBe('VALIDATION_REQUIRED');
      expect(result![0].domain).toBe('cloudcode-pa.googleapis.com');
      expect(result![0].metadata?.validation_link).toBe('https://cloud.google.com/validate');
    });

    it('extracts details from a JSON string payload', () => {
      const jsonStr = JSON.stringify({
        error: {
          details: [
            {
              '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
              reason: 'SECURITY_POLICY_VIOLATED',
            },
          ],
        },
      });

      const result = extractGoogleErrorDetails(jsonStr);
      expect(result).toBeDefined();
      expect(result![0].reason).toBe('SECURITY_POLICY_VIOLATED');
    });

    it('returns undefined for invalid, non-array, or empty details', () => {
      expect(extractGoogleErrorDetails(null)).toBeUndefined();
      expect(extractGoogleErrorDetails({})).toBeUndefined();
      expect(extractGoogleErrorDetails({ error: { details: 'not-an-array' } })).toBeUndefined();
      expect(extractGoogleErrorDetails({ error: { details: [] } })).toBeUndefined();
    });
  });

  describe('classifyForbiddenUpstreamError', () => {
    it('classifies security policy violation from details', () => {
      const classification = classifyForbiddenUpstreamError({
        details: [{ reason: 'SECURITY_POLICY_VIOLATED' }],
      });
      expect(classification.kind).toBe('security_policy_violated');
    });

    it('classifies validation required from details with help links', () => {
      const classification = classifyForbiddenUpstreamError({
        details: [
          {
            type: 'type.googleapis.com/google.rpc.ErrorInfo',
            reason: 'VALIDATION_REQUIRED',
            domain: 'cloudcode-pa.googleapis.com',
            metadata: { validation_link: 'https://cloud.google.com/verify' },
          },
          {
            type: 'type.googleapis.com/google.rpc.Help',
            links: [
              { description: 'verify account', url: 'https://cloud.google.com/verify' },
              { description: 'learn more', url: 'https://support.google.com/article/1' },
            ],
          },
        ],
      });

      expect(classification.kind).toBe('validation_required');
      expect(classification.validationLink).toBe('https://cloud.google.com/verify');
      expect(classification.learnMoreUrl).toBe('https://support.google.com/article/1');
    });

    it('classifies license required from fallback text', () => {
      const classification = classifyForbiddenUpstreamError({
        message: 'Google Cloud Project has no code assist license',
      });
      expect(classification.kind).toBe('license_required');
    });

    it('classifies location ineligible from fallback text', () => {
      const classification = classifyForbiddenUpstreamError({
        message: 'Gemini Code Assist is not currently available in your location.',
      });
      expect(classification.kind).toBe('location_ineligible');
    });

    it('classifies validation required from fallback text mentioning cloudcode domain', () => {
      const classification = classifyForbiddenUpstreamError({
        message:
          'Error VALIDATION_REQUIRED occurred with cloudcode-pa.googleapis.com "validation_link": "https://verify.google.com"',
      });
      expect(classification.kind).toBe('validation_required');
      expect(classification.validationLink).toBe('https://verify.google.com');
    });

    it('defaults to account_forbidden when no condition matches', () => {
      const classification = classifyForbiddenUpstreamError({
        message: 'Generic permission denied 403',
      });
      expect(classification.kind).toBe('account_forbidden');
    });

    it('defaults to account_forbidden when params are empty', () => {
      const classification = classifyForbiddenUpstreamError({});
      expect(classification.kind).toBe('account_forbidden');
    });
  });
});
