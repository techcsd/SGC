import { ApplicationConfig, ErrorHandler, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';
import { AppErrorHandler } from './core/error-handler';
import { WEATHER_PROVIDER } from '../shared/context/weather-provider';
import { OpenMeteoProvider } from '../shared/context/open-meteo.provider';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    { provide: ErrorHandler, useClass: AppErrorHandler },
    // Intelligent Context System — swap this binding to change weather provider.
    { provide: WEATHER_PROVIDER, useClass: OpenMeteoProvider },
  ],
};
