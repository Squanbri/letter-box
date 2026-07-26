import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'letter-box:is-public';
export const Public = () => SetMetadata(IS_PUBLIC, true);
