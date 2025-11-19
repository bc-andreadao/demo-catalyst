import { NextRequest, NextResponse } from 'next/server';
import { client } from '~/client';
import { graphql } from '~/client/graphql';
import { revalidate } from '~/client/revalidate-target';

import { type MiddlewareFactory } from './compose-middlewares';

const GetRouteQuery = graphql(`
  query GetRouteQuery($path: String!) {
    site {
      route(path: $path) {
        node {
          __typename
          id
          ... on Product {
            entityId
          }
          ... on Category {
            entityId
          }
          ... on Brand {
            entityId
          }
          ... on BlogPost {
            entityId
          }
        }
      }
    }
  }
`);

const getRoute = async (path: string, channelId?: string) => {
  const response = await client.fetch({
    document: GetRouteQuery,
    variables: { path },
    fetchOptions: { next: { revalidate } },
    channelId,
  });

  return response.data.site.route;
};

export const withRoutes: MiddlewareFactory = () => {
  return async (request: NextRequest) => {

    const route = await getRoute("/the-planter-by-rustic-roots", "1804873");

    const node = route?.node;

    let url: string = `/en/product/${node?.entityId}`;
    
    const rewriteUrl = new URL(url, request.url);

    console.log("NODE:", node);
    console.log("ORIGINAL:", request.url);
    console.log("TARGET:", url);
    console.log("REWRITTEN:", rewriteUrl.toString());
    return NextResponse.rewrite(rewriteUrl);
  };
};

