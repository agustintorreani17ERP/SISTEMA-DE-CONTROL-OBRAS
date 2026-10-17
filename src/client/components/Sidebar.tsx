import React from "react";
import {
  Building2,
  Calculator,
  ClipboardCheck,
  HardHat,
  Home,
  Package,
  LayoutDashboard,
  LogOut,
  Settings,
  ShoppingCart,
  Wallet,
  Users,
} from "lucide-react";
import { Project, User } from "../types";
import { APPS, type ActiveTab, type AppId } from "../apps";
import {
  Sidebar as SidebarRoot,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "../ui/sidebar";

export type { ActiveTab, SuministrosSubTab } from "../apps";

export interface SidebarBadges {
  compras?: number;
  certificados?: number;
}

interface SidebarProps {
  app: AppId;
  activeTab: ActiveTab;
  onNavigate: (tab: ActiveTab) => void;
  onGoPortfolio: () => void;
  project?: Project | null;
  currentUser?: User | null;
  onLogout: () => void;
  badges?: SidebarBadges;
}

const isActive = (active: ActiveTab, id: ActiveTab) =>
  active === id ||
  (id === "centro-costos" && active === "certificaciones") ||
  (id === "ejecucion-certificaciones" && active === "subcontratistas");

/** Menú lateral (shadcn Sidebar): Inicio (cartera) y, dentro de la obra, sus módulos. */
export const Sidebar: React.FC<SidebarProps> = ({
  app,
  activeTab,
  onNavigate,
  onGoPortfolio,
  project,
  currentUser,
  onLogout,
  badges = {},
}) => {
  const configLabel = APPS[app].catalogo === "insumos" ? "Insumos" : "Proveedores";
  return (
    <SidebarRoot>
      <SidebarHeader>
        <BrandMark app={app} />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <NavButton icon={Home} isActive={!project} tooltip="Todas las obras" onClick={onGoPortfolio}>
                Todas las obras
              </NavButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        {project && (
          <SidebarGroup>
            <SidebarGroupLabel title={project.name}>
              {project.code} · {project.name}
            </SidebarGroupLabel>
            <SidebarMenu>
              {APPS[app].menu.map(({ id, label, icon, badge }) => (
                <SidebarMenuItem key={id}>
                  <NavButton
                    icon={icon}
                    isActive={isActive(activeTab, id)}
                    tooltip={label}
                    onClick={() => onNavigate(id)}
                    badge={badge && (badges[badge] ?? 0) > 0 ? <SidebarMenuBadge>{badges[badge]}</SidebarMenuBadge> : undefined}
                  >
                    {label}
                  </NavButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        {project && (
          <SidebarMenu>
            <SidebarMenuItem>
              <NavButton icon={Settings} isActive={activeTab === "configuracion"} tooltip={configLabel} onClick={() => onNavigate("configuracion")}>
                {configLabel}
              </NavButton>
            </SidebarMenuItem>
          </SidebarMenu>
        )}
        <UserFooter currentUser={currentUser} onLogout={onLogout} />
      </SidebarFooter>
      <SidebarRail />
    </SidebarRoot>
  );
};

/** Botón de navegación: en mobile, cierra el cajón del menú al elegir un destino. */
function NavButton({ onClick, ...props }: React.ComponentProps<typeof SidebarMenuButton>) {
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <SidebarMenuButton
      {...props}
      onClick={(e) => {
        onClick?.(e);
        if (isMobile) setOpenMobile(false);
      }}
    />
  );
}

function BrandMark({ app }: { app: AppId }) {
  const def = APPS[app];
  const { state, isMobile } = useSidebar();
  const collapsed = state === "collapsed" && !isMobile;
  return (
    <>
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white">
        <Building2 className="h-4 w-4" />
      </div>
      {!collapsed && (
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-semibold text-slate-900">{def.name}</p>
          <p className="truncate text-[11px] text-slate-500">{def.tagline}</p>
        </div>
      )}
    </>
  );
}

function UserFooter({ currentUser, onLogout }: { currentUser?: User | null; onLogout: () => void }) {
  const { state, isMobile } = useSidebar();
  const collapsed = state === "collapsed" && !isMobile;
  return (
    <div className={collapsed ? "flex flex-col items-center gap-1 px-0 py-2" : "flex items-center gap-2 px-2.5 py-2"}>
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">
        {currentUser?.initials || "US"}
      </div>
      {!collapsed && (
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-medium text-slate-800">{currentUser?.fullName || "Usuario"}</p>
          <p className="truncate text-[11px] text-slate-500">{currentUser?.roleLabel || currentUser?.role}</p>
        </div>
      )}
      <button
        onClick={onLogout}
        title="Cerrar sesión"
        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );
}
