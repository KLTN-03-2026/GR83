const PROMOTION_CATALOG_CHANGED_EVENT = 'smartride:promotion-catalog-changed';

export function dispatchPromotionCatalogChanged(detail = {}) {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(PROMOTION_CATALOG_CHANGED_EVENT, {
      detail: detail && typeof detail === 'object' ? detail : {},
    }),
  );
}

export function subscribePromotionCatalogChanged(listener) {
  if (typeof window === 'undefined' || typeof listener !== 'function') {
    return () => {};
  }

  const handlePromotionCatalogChanged = (event) => {
    listener(event?.detail ?? {}, event);
  };

  window.addEventListener(PROMOTION_CATALOG_CHANGED_EVENT, handlePromotionCatalogChanged);

  return () => {
    window.removeEventListener(PROMOTION_CATALOG_CHANGED_EVENT, handlePromotionCatalogChanged);
  };
}