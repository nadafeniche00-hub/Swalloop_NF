// Registers every pack. Plain JS, so headless scripts can import it too.
import { registerPack } from '../core/registry.js';
import skyscraper from './skyscraper/pack.js';
import math from './math/pack.js';
import analysis from './analysis/pack.js';

registerPack(skyscraper);
registerPack(math);
registerPack(analysis);
