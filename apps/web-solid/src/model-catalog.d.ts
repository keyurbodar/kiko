declare module "virtual:yuki-model-catalog" {
  /** Url of the hashed model catalog json. Import it lazily, from the settings route only. */
  const url: string;
  export default url;
}
