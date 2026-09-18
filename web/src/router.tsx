import { createBrowserRouter, createHashRouter, Outlet } from "react-router-dom";

import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import UserLayout from "@/layouts/user-layout";
import AssetsPage from "@/pages/assets";
import CanvasPage from "@/pages/canvas";
import CanvasProjectPage from "@/pages/canvas/project";
import ConfigPage from "@/pages/config";
import HomePage from "@/pages/home";
import ImagePage from "@/pages/image";
import NotFound from "@/pages/not-found";
import PromptsPage from "@/pages/prompts";
import StudioPage from "@/pages/studio";
import VideoPage from "@/pages/video";

import { isElectronRuntime } from "@/lib/sqc-fs";

// Electron 用 file:// 加载，BrowserRouter 会在路由跳转/刷新时白屏，改用 HashRouter。
// 浏览器端行为保持不变。
const createRouter = isElectronRuntime() ? createHashRouter : createBrowserRouter;

export const router = createRouter([
    {
        element: (
            <UserLayout>
                <AnalyticsTracker />
                <Outlet />
            </UserLayout>
        ),
        children: [
            { path: "/", element: <HomePage /> },
            { path: "/image", element: <ImagePage /> },
            { path: "/video", element: <VideoPage /> },
            { path: "/assets", element: <AssetsPage /> },
            { path: "/prompts", element: <PromptsPage /> },
            { path: "/canvas", element: <CanvasPage /> },
            { path: "/canvas/:id", element: <CanvasProjectPage /> },
            // 导演台工作台：和画布共享同一份节点数据
            { path: "/canvas/:id/studio", element: <StudioPage /> },
            { path: "/config", element: <ConfigPage /> },
        ],
    },
    { path: "*", element: <NotFound /> },
]);
