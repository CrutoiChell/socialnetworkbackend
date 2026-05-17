import { IsIn, IsOptional, IsString } from 'class-validator';

const ALLOWED = [
  'tier-junk',
  'tier-dust',
  'tier-meteor',
  'tier-supernova',
  'tier-pulsar',
  'premium',
] as const;

export class CustomizeColorDto {
  @IsOptional()
  @IsString()
  @IsIn([...ALLOWED, null as unknown as string])
  colorStyle?: string | null;
}
