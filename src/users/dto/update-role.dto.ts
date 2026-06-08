import { IsIn } from 'class-validator';

const ASSIGNABLE_ROLES = ['USER', 'MODERATOR', 'ADMIN'] as const;

export class UpdateRoleDto {
  @IsIn([...ASSIGNABLE_ROLES])
  role: (typeof ASSIGNABLE_ROLES)[number];
}
