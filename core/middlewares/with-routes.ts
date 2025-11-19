import { NextRequest, NextResponse } from 'next/server';

import { type MiddlewareFactory } from './compose-middlewares';

export const withRoutes: MiddlewareFactory = () => {
  return (request: NextRequest) => {

    const url: string = `/en/product/112`;
    const rewriteUrl = new URL(url, request.url);

    console.log(`ORIGINAL: ${request.url}`);
    console.log(`TARGET: ${url}`);
    console.log(`REWRITTEN: ${rewriteUrl.toString()}`);
    return NextResponse.rewrite(rewriteUrl);
  };
};

