import { NextRequest, NextResponse } from 'next/server';
import { client } from '~/client';
import { graphql } from '~/client/graphql';
import { revalidate } from '~/client/revalidate-target';

import { type MiddlewareFactory } from './compose-middlewares';

const trailingSlashDisabled = process.env.TRAILING_SLASH === 'false';

const GetRouteQuery = graphql(`
  query GetRouteQuery($path: String!) {
    site {
      route(path: $path, redirectBehavior: FOLLOW) {
        redirect {
          to {
            __typename
            ... on BlogPostRedirect {
              path
            }
            ... on BrandRedirect {
              path
            }
            ... on CategoryRedirect {
              path
            }
            ... on PageRedirect {
              path
            }
            ... on ProductRedirect {
              path
            }
            ... on ManualRedirect {
              url
            }
          }
          fromPath
          toUrl
        }
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

const clearLocaleFromPath = (path: string, locale: string) => {
  if (path === `/${locale}` || path === `/${locale}/`) {
    return '/';
  }

  if (path.startsWith(`/${locale}/`)) {
    return path.replace(`/${locale}`, '');
  }

  return path;
};

function normalizeForCompare(url: URL): string {
  if (trailingSlashDisabled && url.pathname !== '/' && url.pathname.endsWith('/')) {
    return `${url.pathname.replace(/\/+$/, '')}${url.search}`;
  }

  if (!trailingSlashDisabled && !url.pathname.endsWith('/')) {
    return `${url.pathname}/${url.search}`;
  }

  return `${url.pathname}${url.search}`;
}

const sameInternalUrl = (a: URL, b: URL) =>
  a.origin === b.origin && normalizeForCompare(a) === normalizeForCompare(b);

export const withRoutes: MiddlewareFactory = () => {
  return async (request: NextRequest) => {
    const channelId = request.headers.get('x-bc-channel-id') ?? '';
    const locale = request.headers.get('x-bc-locale') ?? '';

    const pathname = clearLocaleFromPath(request.nextUrl.pathname + request.nextUrl.search, locale);

    console.log('Locale:', locale);
    console.log('Resolving route for path:', pathname);

    const route = await getRoute(pathname, channelId);

    const redirectConfig = {
      // Use 301 status code as it is more universally supported by crawlers
      status: 301,
      nextConfig: {
        // Preserve the trailing slash if it was present in the original URL
        // BigCommerce by default returns the trailing slash.
        trailingSlash: process.env.TRAILING_SLASH !== 'false',
      },
    };

    if (route?.redirect) {
      // Only carry over query params if the fromPath does not have any, as Bigcommerce 301 redirects support matching by specific query params.
      const fromPathSearchParams = new URL(route.redirect.fromPath, request.url).search;
      const searchParams = fromPathSearchParams.length > 0 ? '' : request.nextUrl.search;

      switch (route.redirect.to.__typename) {
        case 'BlogPostRedirect':
        case 'BrandRedirect':
        case 'CategoryRedirect':
        case 'PageRedirect':
        case 'ProductRedirect': {
          // For dynamic redirects, assume an internal redirect and construct the URL from the path
          const redirectUrl = new URL(route.redirect.to.path + searchParams, request.url);

          if (sameInternalUrl(request.nextUrl, redirectUrl)) {
            break;
          }

          return NextResponse.redirect(redirectUrl, redirectConfig);
        }

        case 'ManualRedirect': {
          // For manual redirects, to.url will be a relative path if it is an internal redirect and an absolute URL if it is an external redirect.
          // URL constructor will correctly handle both cases.
          // If the manual redirect is an external URL, we should not carry query params.
          const redirectUrl = new URL(route.redirect.to.url, request.url);

          if (redirectUrl.origin === request.nextUrl.origin) {
            redirectUrl.search = searchParams;

            if (sameInternalUrl(request.nextUrl, redirectUrl)) {
              break;
            }
          }

          return NextResponse.redirect(redirectUrl, redirectConfig);
        }

        default: {
          // If for some reason the redirect type is not recognized, use the toUrl as a fallback
          return NextResponse.redirect(route.redirect.toUrl, redirectConfig);
        }
      }
    }

    const node = route?.node;

    let url: string;

    switch (node?.__typename) {
      case 'Brand': {
        url = `/${locale}/brand/${node.entityId}`;
        break;
      }

      case 'Category': {
        url = `/${locale}/category/${node.entityId}`;
        break;
      }

      case 'Product': {
        url = `/${locale}/product/${node.entityId}`;
        break;
      }

      case 'NormalPage': {
        url = `/${locale}/webpages/${node.id}/normal/`;
        break;
      }

      case 'ContactPage': {
        url = `/${locale}/webpages/${node.id}/contact/`;
        break;
      }

      case 'RawHtmlPage': {
        const { htmlBody } = await getRawWebPageContent(node.id);

        return new NextResponse(htmlBody, {
          headers: { 'content-type': 'text/html' },
        });
      }

      case 'Blog': {
        url = `/${locale}/blog`;
        break;
      }

      case 'BlogPost': {
        url = `/${locale}/blog/${node.entityId}`;
        break;
      }

      default: {
        const { pathname } = new URL(request.url);

        const cleanPathName = clearLocaleFromPath(pathname, locale);

        url = `/${locale}${cleanPathName}`;
      }
    }

    const rewriteUrl = new URL(url, request.url);
    rewriteUrl.search = request.nextUrl.search;

    console.log('NODE:', node);
    console.log('ORIGINAL:', request.url);
    console.log('TARGET:', url);
    console.log('REWRITTEN:', rewriteUrl.toString());
    return NextResponse.rewrite(rewriteUrl);
  };
};
