{
  config,
  pkgs,
  lib,
  ...
}:
let
  benchLibs = with pkgs; [
    stdenv.cc.cc.lib
    zlib
    glib
    gtk3
    at-spi2-core
    at-spi2-atk
    libxdo
    libX11
    libXtst
    libXi
    libXrandr
    libXext
    libXfixes
    libXcursor
    libxkbcommon
    wayland
    pango
    cairo
    gdk-pixbuf
    harfbuzz
    libGL
    mesa
    dbus
    expat
    openssl
    libdrm
    nspr
    nss
  ];
in
{
  system.stateVersion = "25.05";
  networking.hostName = "bench";
  networking.firewall.enable = false;

  boot.kernelModules = [
    "9p"
    "9pnet_virtio"
  ];

  fileSystems."/mnt/repo" = {
    device = "repo";
    fsType = "9p";
    options = [
      "trans=virtio"
      "version=9p2000.L"
      "rw"
      "nofail"
    ];
    neededForBoot = false;
  };

  virtualisation = {
    memorySize = 4096;
    cores = 2;
    graphics = false;
    forwardPorts = [
      {
        from = "host";
        host.port = 2222;
        guest.port = 22;
      }
    ];
    sharedDirectories.repo = {
      source = "/tmp/kiko-bench-repo";
      target = "/mnt/repo";
    };
  };

  services.openssh = {
    enable = true;
    settings = {
      PasswordAuthentication = true;
      KbdInteractiveAuthentication = false;
      PermitRootLogin = "no";
    };
  };

  users.users.bench = {
    isNormalUser = true;
    password = "bench";
    extraGroups = [
      "wheel"
      "input"
      "video"
      "render"
    ];
  };
  security.sudo.wheelNeedsPassword = false;

  services.gnome.at-spi2-core.enable = true;
  services.gnome.gnome-keyring.enable = true;
  services.udisks2.enable = true;
  security.polkit.enable = true;

  hardware.graphics.enable = true;
  fonts.fontconfig.enable = true;
  fonts.packages = with pkgs; [
    dejavu_fonts
    liberation_ttf
  ];

  programs.nix-ld.enable = true;
  programs.nix-ld.libraries = benchLibs;

  environment.sessionVariables = {
    NO_AT_BRIDGE = "0";
    GTK_A11Y = "atspi";
    LIBGL_ALWAYS_SOFTWARE = "1";
    XDG_SESSION_TYPE = "wayland";
    XDG_CURRENT_DESKTOP = "GNOME";
    MOZ_ENABLE_WAYLAND = "0";
  };

  environment.systemPackages =
    with pkgs;
    [
      bash
      coreutils
      curl
      dbus
      file
      findutils
      gawk
      git
      gnugrep
      gnused
      gnumake
      jq
      less
      openssh
      procps
      psmisc
      sqlite
      tmux
      unzip
      vim
      which
      zip
      python3
      nodejs_22
      bun
      chromium
      libreoffice-fresh
      gnome-text-editor
      gnome-shell
      gnome-session
      mutter
      xwayland
      xdotool
      glib
      gtk3
      at-spi2-core
      libxkbcommon
      wayland
      mesa
      libGL
      xorg.xauth
      xorg.xdpyinfo
      xorg.xwininfo
      xorg.xprop
    ]
    ++ benchLibs;
}
