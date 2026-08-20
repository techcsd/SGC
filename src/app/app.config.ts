import { ApplicationConfig, ErrorHandler, LOCALE_ID, provideBrowserGlobalErrorListeners } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeEsDO from '@angular/common/locales/es-DO';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';

// AT22 — locale República Dominicana para que DatePipe y demás formatos nativos
// rendericen en español (meses, a. m./p. m.) en vez del en-US por defecto.
registerLocaleData(localeEsDO);
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
    { provide: LOCALE_ID, useValue: 'es-DO' },
    // Intelligent Context System — swap these bindings to change providers.
    { provide: WEATHER_PROVIDER, useClass: OpenMeteoProvider },
    { provide: AIR_QUALITY_PROVIDER, useClass: OpenMeteoAirProvider },
  ],
};
