import { IsIn } from 'class-validator';

export class SetThemeDto {
  @IsIn(['DEFAULT', 'NEBULA', 'SUPERNOVA'])
  theme: 'DEFAULT' | 'NEBULA' | 'SUPERNOVA';
}
