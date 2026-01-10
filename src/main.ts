import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import * as bodyParser from 'body-parser';
import morgan from 'morgan';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  /**
   * 👀 REAL-TIME REQUEST LOGGING
   */
  app.use(morgan('dev'));

  /**
   * 📦 BODY PARSERS (Paynow requires urlencoded)
   */
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: false }));

  /**
   * 🔐 Global validation
   */
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  /**
   * 🌍 CORS
   */
  app.enableCors({
    origin: true,
    credentials: true,
  });

  /**
   * 🚀 Railway-safe port binding
   */
  const port = Number(process.env.PORT) || 8080;
  await app.listen(port, '0.0.0.0');

  console.log(`🚀 Application is running on: http://0.0.0.0:${port}`);
}

bootstrap();
