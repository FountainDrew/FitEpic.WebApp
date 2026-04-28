import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';

import { environment } from '../../../environments/environment';
import { ApiConfiguration } from './generated/api-configuration';

export function provideFitEpicApi(): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: ApiConfiguration,
      useFactory: () => {
        const config = new ApiConfiguration();
        config.rootUrl = environment.apiBaseUrl;
        return config;
      },
    },
  ]);
}
