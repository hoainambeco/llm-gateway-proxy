import { buildOfficialSystemInstruction } from './OfficialSystemInstruction';

describe('OfficialSystemInstruction', () => {
  it('applies fallbackIdentity when no identity is provided in instructions', () => {
    const result = buildOfficialSystemInstruction([], 'You are Antigravity Assistant.');
    expect(result).toContain('<identity>\nYou are Antigravity Assistant.\n</identity>');
  });

  it('includes globalSystemPrompt section when provided', () => {
    const result = buildOfficialSystemInstruction(
      ['Some generic instruction'],
      'Default Bot',
      'Follow corporate guidelines.',
    );
    expect(result).toContain('<global_system_prompt>\nFollow corporate guidelines.\n</global_system_prompt>');
  });

  it('classifies tagged sections correctly', () => {
    const instructions = [
      '<permissions instructions>\nAllow terminal commands.\n</permissions instructions>',
      '<app-context>\nProject is a NestJS gateway.\n</app-context>',
      '<skills_instructions>\nSkill: test-runner.\n</skills_instructions>',
      '<plugins_instructions>\nPlugin: git-helper.\n</plugins_instructions>',
      '<collaboration_mode>\nPair programming mode.\n</collaboration_mode>',
    ];

    const result = buildOfficialSystemInstruction(instructions, 'Fallback Bot');

    expect(result).toContain('<environment_permissions>\nAllow terminal commands.\n</environment_permissions>');
    expect(result).toContain('<app_context>\nProject is a NestJS gateway.\n</app_context>');
    expect(result).toContain('<skills>\nSkill: test-runner.\n</skills>');
    expect(result).toContain('<plugins>\nPlugin: git-helper.\n</plugins>');
    expect(result).toContain('<planning_mode>\nPair programming mode.\n</planning_mode>');
  });

  it('extracts ## Memory blocks into the memory section', () => {
    const instruction = 'General setup info.\n\n## Memory\nUser prefers TypeScript strict mode.';
    const result = buildOfficialSystemInstruction([instruction], 'Fallback Bot');

    expect(result).toContain('<customizations>\nGeneral setup info.\n</customizations>');
    expect(result).toContain('<memory>\n## Memory\nUser prefers TypeScript strict mode.\n</memory>');
  });

  it('splits identity and communication style when markers are found', () => {
    const instruction =
      'You are Antigravity, an AI assistant.\n\n# Working with the user\nBe concise and clear.';
    const result = buildOfficialSystemInstruction([instruction], 'Fallback Bot');

    expect(result).toContain('<identity>\nYou are Antigravity, an AI assistant.\n</identity>');
    expect(result).toContain('<communication_style>\n# Working with the user\nBe concise and clear.\n</communication_style>');
  });

  it('strips codex turn markers and collapses blank lines', () => {
    const instruction =
      'Custom rule 1.\n[codex-turn:user step:1 type:tool tool:exec call_id:123]\nCustom rule 2.\n\n\n\nCustom rule 3.';
    const result = buildOfficialSystemInstruction([instruction], 'Fallback Bot');

    expect(result).not.toContain('[codex-turn');
    expect(result).toContain('Custom rule 1.\nCustom rule 2.\n\nCustom rule 3.');
  });

  it('deduplicates identical section entries', () => {
    const instructions = [
      '<skills_instructions>\nSame skill.\n</skills_instructions>',
      '<skills_instructions>\nSame skill.\n</skills_instructions>',
    ];

    const result = buildOfficialSystemInstruction(instructions, 'Fallback Bot');
    const skillCount = (result.match(/Same skill\./g) || []).length;
    expect(skillCount).toBe(1);
  });
});
