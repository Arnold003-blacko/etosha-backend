import { Controller, Get } from '@nestjs/common';

@Controller()
export class RootController {
  @Get('/')
  root() {
    return 'ROOT OK';
  }
}
