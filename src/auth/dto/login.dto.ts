import { IsString, MinLength } from 'class-validator';

/** Поле historically называется email; принимается почта или username. */
export class LoginDto {
  @IsString()
  @MinLength(3)
  email: string;

  @IsString()
  @MinLength(1)
  password: string;
}
