import React from "react";
import { createRoot } from "react-dom/client";
import "antd/dist/reset.css";
import "streamdown/styles.css";
import "./styles/globals.css";
import { RouterProvider } from "react-router-dom";

import { AppProviders } from "@/components/layout/app-providers";
import "@/i18n";
import { initAnalytics } from "@/lib/analytics";
import { ensureSqcDataRoot, isElectronRuntime } from "@/lib/sqc-fs";
import { router } from "@/router";

initAnalytics();

// Electron 下先把便携数据根的版本标记写好，为后续格式迁移留钩子。
if (isElectronRuntime()) void ensureSqcDataRoot(__APP_VERSION__);


document.body.style.fontFamily = '"SF Pro Display","SF Pro Text","PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif';

createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <AppProviders>
            <RouterProvider router={router} />
        </AppProviders>
    </React.StrictMode>,
);
