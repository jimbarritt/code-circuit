class DistributionWorker
  include Sidekiq::Worker

  def perform(status_id)
    FanOutOnWriteWorker.perform_async(status_id)
  end
end
