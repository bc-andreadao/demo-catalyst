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

const getRawWebPageContentQuery = graphql(`
  query getRawWebPageContent($id: ID!) {
    node(id: $id) {
      __typename
      ... on RawHtmlPage {
        htmlBody
      }
    }
  }
`);

const getRawWebPageContent = async (id: string) => {
  const response = await client.fetch({
    document: getRawWebPageContentQuery,
    variables: { id },
  });

  const node = response.data.node;

  if (node?.__typename !== 'RawHtmlPage') {
    throw new Error('Failed to fetch raw web page content');
  }

  return node;
};

export const withRoutes: MiddlewareFactory = () => {
  return async (request: NextRequest) => {
    const pathname = request.nextUrl.pathname;
    const channelId = request.headers.get('x-bc-channel-id') ?? '';

    console.log('Resolving route for path:', pathname);

    const route = await getRoute(pathname, channelId);

    const node = route?.node;

    let url: string;

    switch (node?.__typename) {
      case 'Brand': {
        url = `/en/brand/${node.entityId}`;
        break;
      }

      case 'Category': {
        url = `/en/category/${node.entityId}`;
        break;
      }

      case 'Product': {
        url = `/en/product/${node.entityId}`;
        break;
      }

      case 'NormalPage': {
        url = `/en/webpages/${node.id}/normal/`;
        break;
      }

      case 'ContactPage': {
        url = `/en/webpages/${node.id}/contact/`;
        break;
      }

      case 'RawHtmlPage': {
        const { htmlBody } = await getRawWebPageContent(node.id);

        return new NextResponse(htmlBody, {
          headers: { 'content-type': 'text/html' },
        });
      }

      case 'Blog': {
        url = `/en/blog`;
        break;
      }

      case 'BlogPost': {
        url = `/en/blog/${node.entityId}`;
        break;
      }

      default: {
        const { pathname } = new URL(request.url);
        url = `/en${pathname}`;
      }
    }

    const rewriteUrl = new URL(url, request.url);

    console.log('NODE:', node);
    console.log('ORIGINAL:', request.url);
    console.log('TARGET:', url);
    console.log('REWRITTEN:', rewriteUrl.toString());
    return NextResponse.rewrite(rewriteUrl);
  };
};
