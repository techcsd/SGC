import React from 'react';
import { Pantalla as Android } from './android.screen';
import { Pantalla as IPhone } from './iphone.screen';
import { Pantalla as Preuso } from './preuso.screen';

export const INSTALL_SCREENS: Record<string, React.FC<{ fase: number; frame: number; atOf: (f: number) => number }>> = {
  'android': Android,
  'iphone': IPhone,
  'preuso': Preuso,
};
