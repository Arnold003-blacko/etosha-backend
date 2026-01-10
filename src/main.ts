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

  /**
   * 🫀 HEARTBEAT — proves container is still alive
   * (SAFE on Railway)
   */
  setInterval(() => {
    console.log('🫀 Container heartbeat: app is still running');
  }, 10000);
}

bootstrap();

/**
 * 👀 OBSERVABILITY ONLY — does NOT shut down the app
 * These logs appear when Railway stops the container
 */

process.on('beforeExit', (code) => {
  console.log(`⚠️ Process beforeExit event with code: ${code}`);
});

process.on('exit', (code) => {
  console.log(`🛑 Process exit event with code: ${code}`);
});
