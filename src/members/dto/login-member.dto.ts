 import { IsEmail, IsNotEmpty } from 'class-validator';

export class LoginMemberDto {
  @IsEmail()
  email: string;

  @IsNotEmpty()
  password: string;
}
