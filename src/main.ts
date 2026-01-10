import { NestFactory } from '@nestjs/core';
import { Controller, Get, Module } from '@nestjs/common';

@Controller()
class TestController {
  @Get('/')
  root() {
    return 'OK';
  }

  @Get('/health')
  health() {
    return { status: 'ok' };
  }
}

@Module({
  controllers: [TestController],
})
class TestModule {}

async function bootstrap() {
  const app = await NestFactory.create(TestModule);
  const port = Number(process.env.PORT) || 8080;
  await app.listen(port, '0.0.0.0');
  console.log(`TEST APP RUNNING ON ${port}`);
}

bootstrap();
