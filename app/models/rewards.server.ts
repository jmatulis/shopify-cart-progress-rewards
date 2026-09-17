import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

import {
  DEFAULT_CONFIG,
  METAFIELD_KEY,
  METAFIELD_NAMESPACE,
  validateConfig,
  type RewardsConfig,
} from "../lib/rewards";

type Admin = AdminApiContext;

/**
 * Loads the saved config plus the IDs we need to save it again.
 * `currentAppInstallation` is this app's install on the current shop, so no
 * access scopes are required to read or write its metafields.
 */
export async function getRewardsSettings(admin: Admin) {
  const response = await admin.graphql(
    `#graphql
      query RewardsSettings($namespace: String!, $key: String!) {
        shop {
          currencyCode
        }
        currentAppInstallation {
          id
          metafield(namespace: $namespace, key: $key) {
            jsonValue
          }
        }
      }`,
    { variables: { namespace: METAFIELD_NAMESPACE, key: METAFIELD_KEY } },
  );
  const { data } = await response.json();

  const stored = data?.currentAppInstallation?.metafield?.jsonValue;
  return {
    appInstallationId: data!.currentAppInstallation.id as string,
    currencyCode: data!.shop.currencyCode as string,
    config: stored ? validateConfig(stored).config : DEFAULT_CONFIG,
    isSaved: Boolean(stored),
  };
}

export async function saveRewardsConfig(
  admin: Admin,
  appInstallationId: string,
  config: RewardsConfig,
) {
  const response = await admin.graphql(
    `#graphql
      mutation SaveRewardsConfig($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            id
          }
          userErrors {
            field
            message
          }
        }
      }`,
    {
      variables: {
        metafields: [
          {
            ownerId: appInstallationId,
            namespace: METAFIELD_NAMESPACE,
            key: METAFIELD_KEY,
            type: "json",
            value: JSON.stringify(config),
          },
        ],
      },
    },
  );
  const { data } = await response.json();
  return (data?.metafieldsSet?.userErrors ?? []) as {
    field: string[] | null;
    message: string;
  }[];
}
