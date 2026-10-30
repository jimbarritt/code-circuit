class FanOutOnWriteWorker
  include Sidekiq::Worker

  def perform(status_id)
    FeedManager.instance.push_to_home(status_id)
  end
end
