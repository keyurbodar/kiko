{
  description = "kiko bench environment: NixOS 25.05 with GNOME on Wayland";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/ac62194c3917d5f474c1a844b6fd6da2db95077d";

  outputs =
    { self, nixpkgs }:
    {
      nixosConfigurations.bench = nixpkgs.lib.nixosSystem {
        system = "x86_64-linux";
        modules = [ ./configuration.nix ];
      };
    };
}
