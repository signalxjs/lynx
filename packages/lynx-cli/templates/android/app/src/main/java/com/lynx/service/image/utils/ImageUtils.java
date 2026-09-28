// Copyright 2024 The Lynx Authors. All rights reserved.
// Licensed under the Apache License Version 2.0 that can be found in the
// LICENSE file in the root directory of this source tree.

package com.lynx.service.image.utils;

import android.net.Uri;
import com.facebook.cache.common.CacheKey;
import com.facebook.common.references.CloseableReference;
import com.facebook.drawee.backends.pipeline.Fresco;
import com.facebook.imagepipeline.cache.CacheKeyFactory;
import com.facebook.imagepipeline.cache.MemoryCache;
import com.facebook.imagepipeline.common.ImageDecodeOptionsBuilder;
import com.facebook.imagepipeline.common.Priority;
import com.facebook.imagepipeline.common.ResizeOptions;
import com.facebook.imagepipeline.image.CloseableImage;
import com.facebook.imagepipeline.request.ImageRequest;
import com.facebook.imagepipeline.request.ImageRequestBuilder;
import com.lynx.service.image.decoder.MultiPostProcessor;
import com.lynx.tasm.image.model.DiskCacheChoice;
import com.lynx.tasm.image.model.ImageRequestInfo;

public class ImageUtils {
  private static CacheKeyFactory sCacheKeyFactory = null;

  public static ResizeOptions getResizeOptions(
      int width, int height, int lastWidth, int lastHeight) {
    if (lastWidth <= 0 || lastHeight <= 0 || Math.abs(width - lastWidth) > 1
        || Math.abs(height - lastHeight) > 1) {
      return new ResizeOptions(width, height);
    }
    return new ResizeOptions(lastWidth, lastHeight);
  }

  public static ImageRequest getFrescoImageRequest(ImageRequestInfo imageRequestInfo) {
    ImageRequestBuilder builder =
        ImageRequestBuilder.newBuilderWithSource(Uri.parse(imageRequestInfo.getUrl()));
    ImageDecodeOptionsBuilder decodeOptionsBuilder = new ImageDecodeOptionsBuilder();
    if (imageRequestInfo.getConfig() != null) {
      decodeOptionsBuilder.setBitmapConfig(imageRequestInfo.getConfig());
    }
    builder.setAutoRotateEnabled(true).setProgressiveRenderingEnabled(false);
    if (!imageRequestInfo.isEnableResourceHint()) {
      ResizeOptions resizeOptions = imageRequestInfo.isEnableDownSampling()
          ? new ResizeOptions(imageRequestInfo.getResizeWidth(), imageRequestInfo.getResizeHeight())
          : null;
      if (resizeOptions != null) {
        builder.setResizeOptions(resizeOptions);
      }
    }
    if (imageRequestInfo.getDiskCacheChoice() != null
        && DiskCacheChoice.SMALL_DISK == imageRequestInfo.getDiskCacheChoice()) {
      builder.setCacheChoice(ImageRequest.CacheChoice.SMALL);
    }
    if (imageRequestInfo.isEnableAsyncRequest()) {
      builder.setRequestPriority(Priority.HIGH);
    }
    if (imageRequestInfo.getProcessors() != null && !imageRequestInfo.getProcessors().isEmpty()) {
      MultiPostProcessor postProcessor =
          new MultiPostProcessor(imageRequestInfo.getProcessors(), imageRequestInfo.getConfig());
      builder.setPostprocessor(postProcessor);
    }
    return builder.build();
  }

  public static CloseableReference<CloseableImage> getCachedImage(
      MemoryCache<CacheKey, CloseableImage> memoryCache, CacheKey cacheKey) {
    if (memoryCache == null || cacheKey == null) {
      return null;
    }
    // We get the CacheKey
    CloseableReference<CloseableImage> closeableImage = memoryCache.get(cacheKey);
    if (closeableImage != null && !closeableImage.get().getQualityInfo().isOfFullQuality()) {
      closeableImage.close();
      return null;
    }
    return closeableImage;
  }

  public static CacheKey getCacheKey(ImageRequest imageRequest, Object callerContext) {
    CacheKey cacheKey = null;
    if (sCacheKeyFactory == null) {
      sCacheKeyFactory = Fresco.getImagePipeline().getCacheKeyFactory();
    }
    if (sCacheKeyFactory != null && imageRequest != null) {
      if (imageRequest.getPostprocessor() != null) {
        cacheKey = sCacheKeyFactory.getPostprocessedBitmapCacheKey(imageRequest, callerContext);
      } else {
        cacheKey = sCacheKeyFactory.getBitmapCacheKey(imageRequest, callerContext);
      }
    }
    return cacheKey;
  }
}
