import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import * as bodyParser from 'body-parser';
import morgan from 'morgan';
import { IoAdapter } from '@nestjs/platform-socket.io';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Configure WebSocket adapter for Socket.IO
  // CORS is handled globally below and in gateway decorators
  app.useWebSocketAdapter(new IoAdapter(app));

  /**
   * 👀 HTTP request logging
   */
  app.use(morgan('dev'));

  /**
   * 📦 BODY PARSERS
   * PayNow requires urlencoded payloads
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
   * 🌍 CORS - Allow all origins for development and production
   */
  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, Postman, or server-to-server)
      if (!origin) {
        return callback(null, true);
      }
      // Allow all origins - adjust this in production if needed
      callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With'],
    exposedHeaders: ['Content-Length', 'Content-Type'],
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  /**
   * 🚀 Railway-safe port binding
   */
  const port = Number(process.env.PORT) || 8080;
  await app.listen(port, '0.0.0.0');

  console.log(`🚀 Application is running on port ${port}`);
}

bootstrap();
