import { ApplicationConfig, ErrorHandler, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';
import { AppErrorHandler } from './core/error-handler';
import { WEATHER_PROVIDER } from '../shared/context/weather-provider';
import { OpenMeteoProvider } from '../shared/context/open-meteo.provider';
import { AIR_QUALITY_PROVIDER } from '../shared/context/air-quality-provider';
import { OpenMeteoAirProvider } from '../shared/context/open-meteo-air.provider';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    { provide: ErrorHandler, useClass: AppErrorHandler },
    // Intelligent Context System — swap these bindings to change providers.
    { provide: WEATHER_PROVIDER, useClass: OpenMeteoProvider },
    { provide: AIR_QUALITY_PROVIDER, useClass: OpenMeteoAirProvider },
  ],
};
