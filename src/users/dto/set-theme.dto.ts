import { IsIn } from 'class-validator';

const ALLOWED_THEMES = [
  'DEFAULT',
  'NEBULA',
  'SUPERNOVA',
  'PULSAR_RING',
  'AURORA_DEEP',
  'VOID_HORIZON',
] as const;

export class SetThemeDto {
  @IsIn([...ALLOWED_THEMES])
  theme: (typeof ALLOWED_THEMES)[number];
}
