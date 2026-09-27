# Windows editors do not reliably emit inotify events through WSL's /mnt/c mount.
# Keep the official Theme CLI watcher, but use Listen's supported polling adapter.
require "listen"

module ISBFForcePolling
  def to(*directories, **options, &block)
    super(*directories, **options.merge(force_polling: true), &block)
  end
end

Listen.singleton_class.prepend(ISBFForcePolling)
